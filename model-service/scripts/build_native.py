"""Build against an external checkout without modifying its tracked files."""
import argparse
import json
import os
from pathlib import Path
import subprocess


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--cuda", action="store_true")
    parser.add_argument("--cuda-root", type=Path, help="Extracted or installed CUDA Toolkit root")
    parser.add_argument("--cuda-arch", default="native", help="CMake CUDA architecture, e.g. 86-real for RTX 3060")
    parser.add_argument("--msvc-tools", type=Path, help="Optional VC/Tools/MSVC/<version> directory on Windows")
    parser.add_argument("--build-dir", type=Path)
    parser.add_argument("--parallel", type=int, default=4)
    parser.add_argument("--with-cli", action="store_true", help="Build a matching upstream CLI for measurement")
    parser.add_argument("--cpu-arch", choices=["portable", "avx2"], default="portable")
    args = parser.parse_args()
    if args.cuda_root and not args.cuda:
        parser.error("--cuda-root requires --cuda")
    if args.parallel < 1:
        parser.error("--parallel must be positive")
    root = Path(__file__).resolve().parents[1]
    build = args.build_dir or root / "native" / ("build-cuda" if args.cuda else "build-cpu")
    environment = os.environ.copy()
    generator: list[str] = []
    compiler_options: list[str] = []
    if os.name == "nt":
        vswhere = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft Visual Studio/Installer/vswhere.exe"
        installation = subprocess.check_output([str(vswhere), "-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], text=True).strip()
        if not installation:
            raise SystemExit("Install the Visual Studio C++ tools first")
        setup = Path(installation) / "VC/Auxiliary/Build/vcvars64.bat"
        # Only the discovered installation path is passed to cmd; build paths
        # stay separate argv values in all file/compiler operations below.
        output = subprocess.check_output(f'cmd.exe /d /s /c ""{setup}" >nul && set"', text=True)
        environment = {key.upper(): value for key, value in environment.items()}
        for line in output.splitlines():
            key, separator, value = line.partition("=")
            if separator and key:
                environment[key.upper()] = value
        ninja = Path(installation) / "Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja/ninja.exe"
        generator = ["-G", "Ninja", f"-DCMAKE_MAKE_PROGRAM={ninja}"]
        if args.msvc_tools:
            tools = args.msvc_tools.resolve()
            compiler = tools / "bin/Hostx64/x64/cl.exe"
            if not compiler.is_file() or not (tools / "include/vector").is_file() or not (tools / "lib/x64/msvcrt.lib").is_file():
                parser.error("--msvc-tools must contain the x64 compiler, C++ headers and CRT libraries")
            # Keep the installed Windows SDK, but use a consistent supported
            # compiler/header/library version for the CUDA build.
            previous = environment.get("VCTOOLSINSTALLDIR", "").rstrip("\\/").lower()
            for variable, directory in [("INCLUDE", tools / "include"), ("LIB", tools / "lib/x64")]:
                entries = environment.get(variable, "").split(os.pathsep)
                entries = [entry for entry in entries if entry and not (previous and entry.lower().startswith(previous + "\\"))]
                environment[variable] = os.pathsep.join([str(directory), *entries])
            environment["PATH"] = str(compiler.parent) + os.pathsep + environment.get("PATH", "")
            environment["VCTOOLSINSTALLDIR"] = str(tools) + "\\"
            compiler_options = [f"-DCMAKE_C_COMPILER={compiler}", f"-DCMAKE_CXX_COMPILER={compiler}"]
            if args.cuda:
                compiler_options.append(f"-DCMAKE_CUDA_HOST_COMPILER={compiler}")
    elif args.msvc_tools:
        parser.error("--msvc-tools is only supported on Windows")
    if args.cuda:
        compiler_options.append(f"-DCMAKE_CUDA_ARCHITECTURES={args.cuda_arch}")
        if args.cuda_root:
            cuda = args.cuda_root.resolve()
            nvcc = cuda / "bin" / ("nvcc.exe" if os.name == "nt" else "nvcc")
            if not nvcc.is_file():
                parser.error("--cuda-root does not contain bin/nvcc")
            compiler_options.extend([f"-DCUDAToolkit_ROOT={cuda}", f"-DCMAKE_CUDA_COMPILER={nvcc}"])
            environment["CUDA_PATH"] = str(cuda)
            environment["PATH"] = str(cuda / "bin") + os.pathsep + environment.get("PATH", "")
    command = ["cmake", "-S", str(root / "native"), "-B", str(build), *generator,
               *compiler_options,
               f"-DCN360_BUILD_CLI={'ON' if args.with_cli else 'OFF'}",
               f"-DLOCATE_ANYTHING_SOURCE={args.source.resolve()}", "-DCMAKE_BUILD_TYPE=Release",
               f"-DLA_GGML_CUDA={'ON' if args.cuda else 'OFF'}",
               f"-DGGML_AVX={'ON' if args.cpu_arch == 'avx2' else 'OFF'}", f"-DGGML_AVX2={'ON' if args.cpu_arch == 'avx2' else 'OFF'}",
               "-DGGML_NATIVE=OFF", "-DGGML_AVX512=OFF", "-DGGML_AVX512_VNNI=OFF", "-DGGML_AVX512_BF16=OFF"]
    subprocess.run(command, env=environment, check=True)
    subprocess.run(["cmake", "--build", str(build), "--config", "Release", "--parallel", str(args.parallel)], env=environment, check=True)
    print(json.dumps({"build": str(build.resolve()), "cuda_requested": args.cuda}))


if __name__ == "__main__":
    main()
