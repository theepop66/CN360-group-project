// Checked adaptation of the upstream Engine pipeline; see NOTICE.md.
// This ABI deliberately reports failed stages instead of returning empty boxes.
#include "model_loader.hpp"
#include "backend.hpp"
#include "tokenizer.hpp"
#include "image_io.hpp"
#include "prompt.hpp"
#include "vit_encoder.hpp"
#include "projector.hpp"
#include "lm.hpp"
#include "boxes.hpp"
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <thread>

#ifdef _WIN32
#define CN_API extern "C" __declspec(dllexport)
#else
#define CN_API extern "C" __attribute__((visibility("default")))
#endif

namespace {
thread_local std::string last_error;

void require(bool condition, const char* stage) {
    if (!condition) throw std::runtime_error(stage);
}

std::string quote(const std::string& value) {
    std::string result = "\"";
    const char* hex = "0123456789abcdef";
    for (unsigned char ch : value) {
        if (ch == '"' || ch == '\\') { result += '\\'; result += ch; }
        else if (ch < 0x20) { result += "\\u00"; result += hex[ch >> 4]; result += hex[ch & 15]; }
        else result += ch;
    }
    return result + '"';
}

class CheckedEngine {
public:
    la::ModelLoader model;
    la::Backend backend;
    la::Tokenizer tokenizer;

    CheckedEngine(const char* path, int threads) {
        require(path && model.load(path), "model_load_failed");
        require(tokenizer.load(model), "tokenizer_load_failed");
        backend.set_n_threads(threads > 0 ? threads : static_cast<int>(std::thread::hardware_concurrency()));
        require(model.offload_weights(backend), "weight_offload_failed");
    }

    std::vector<la::Box> locate(const unsigned char* bytes, size_t length, const char* prompt, int mode) {
        require(bytes && length > 0 && prompt && *prompt, "invalid_input");
        la::Image image;
        require(la::load_image_rgb_buffer(bytes, length, image), "image_decode_failed");
        la::Preprocessed pixels;
        require(la::preprocess(image, pixels), "preprocess_failed");
        auto ids = la::build_prompt(tokenizer, pixels.gh, pixels.gw, prompt);
        require(!ids.empty(), "prompt_failed");
        la::VitEncoder vision(model, backend);
        std::vector<float> encoded;
        std::vector<std::vector<float>> captures;
        require(vision.forward(pixels.pixel_values, pixels.gh, pixels.gw, encoded, {}, captures), "vision_failed");
        auto merged = la::merge_patches(encoded, pixels.gh, pixels.gw, 1152);
        la::Projector projector(model, backend);
        std::vector<float> projected;
        require(projector.project(merged, projected), "projector_failed");
        la::LMForward language(model, backend);
        std::vector<int32_t> generated;
        bool decoded = mode == 1
            ? language.decode_greedy_resident(ids, projected, 256, generated)
            : language.decode_hybrid(ids, projected, 256, generated, nullptr, mode == 2, !std::getenv("LA_NO_EARLYSTOP"));
        require(decoded, "decode_failed");
        // Upstream parsing skips malformed boxes; an inspection cannot treat
        // malformed/truncated geometry as proof that no defect was detected.
        for (size_t i = 0; i < generated.size(); ++i) {
            if (generated[i] != 151668) continue;
            // Upstream mtp::handle_pattern encodes a valid absence as
            // <box>None</box> (NONE=4064), not a malformed coordinate box.
            if (i + 2 < generated.size() && generated[i + 1] == 4064 && generated[i + 2] == 151669) {
                i += 2;
                continue;
            }
            int coordinates = 0;
            while (++i < generated.size() && generated[i] != 151669) {
                if (generated[i] >= 151677 && generated[i] <= 152677) {
                    ++coordinates;
                } else {
                    const auto separator = tokenizer.decode({generated[i]});
                    require(!separator.empty() && separator.find_first_not_of("()[], \t\r\n") == std::string::npos, "invalid_box_tokens");
                }
            }
            require(i < generated.size() && coordinates == 4, "incomplete_box");
        }
        auto boxes = la::parse_boxes(generated, image.w, image.h,
            [&](const std::vector<int32_t>& tokens) { return tokenizer.decode(tokens); });
        for (const auto& box : boxes) {
            require(std::isfinite(box.x1) && std::isfinite(box.y1) && std::isfinite(box.x2) && std::isfinite(box.y2)
                && box.x2 > box.x1 && box.y2 > box.y1, "invalid_box_geometry");
        }
        return boxes;
    }
};
}

CN_API void* cn_load(const char* path, int threads) {
    try { last_error.clear(); return new CheckedEngine(path, threads); }
    catch (const std::exception& error) { last_error = error.what(); return nullptr; }
    catch (...) { last_error = "model_load_failed"; return nullptr; }
}

CN_API void* cn_predict(void* context, const unsigned char* bytes, size_t length, const char* prompt, int mode) {
    try {
        require(context != nullptr && mode >= 0 && mode <= 2, "invalid_context");
        last_error.clear();
        auto boxes = static_cast<CheckedEngine*>(context)->locate(bytes, length, prompt, mode);
        std::ostringstream json;
        json.precision(9);
        json << "{\"detections\":[";
        for (size_t i = 0; i < boxes.size(); ++i) {
            const auto& box = boxes[i];
            if (i) json << ',';
            json << "{\"label\":" << quote(box.label) << ",\"box\":[" << box.x1 << ',' << box.y1 << ',' << box.x2 << ',' << box.y2 << "]}";
        }
        json << "]}";
        const auto result = json.str();
        void* buffer = std::malloc(result.size() + 1);
        require(buffer != nullptr, "allocation_failed");
        std::memcpy(buffer, result.c_str(), result.size() + 1);
        return buffer;
    } catch (const std::exception& error) { last_error = error.what(); return nullptr; }
      catch (...) { last_error = "inference_failed"; return nullptr; }
}

CN_API const char* cn_backend(void* context) { return context ? static_cast<CheckedEngine*>(context)->backend.device_name().c_str() : "unavailable"; }
CN_API const char* cn_error() { return last_error.c_str(); }
CN_API void cn_free_string(void* buffer) { std::free(buffer); }
CN_API void cn_close(void* context) { delete static_cast<CheckedEngine*>(context); }
