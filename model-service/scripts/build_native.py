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
    parser.add_argument("--build-dir", type=Path)
    parser.add_argument("--cpu-arch", choices=["portable", "avx2"], default="portable")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    build = args.build_dir or root / "native" / ("build-cuda" if args.cuda else "build-cpu")
    environment = os.environ.copy()
    generator: list[str] = []
    if os.name == "nt":
        vswhere = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft Visual Studio/Installer/vswhere.exe"
        installation = subprocess.check_output([str(vswhere), "-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], text=True).strip()
        if not installation:
            raise SystemExit("Install the Visual Studio C++ tools first")
        setup = Path(installation) / "VC/Auxiliary/Build/vcvars64.bat"
        # Only the discovered installation path is passed to cmd; build paths
        # stay separate argv values in all file/compiler operations below.
        output = subprocess.check_output(f'cmd.exe /d /s /c ""{setup}" >nul && set"', text=True)
        for line in output.splitlines():
            key, separator, value = line.partition("=")
            if separator and key:
                environment[key] = value
        ninja = Path(installation) / "Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja/ninja.exe"
        generator = ["-G", "Ninja", f"-DCMAKE_MAKE_PROGRAM={ninja}"]
    command = ["cmake", "-S", str(root / "native"), "-B", str(build), *generator,
               f"-DLOCATE_ANYTHING_SOURCE={args.source.resolve()}", "-DCMAKE_BUILD_TYPE=Release",
               f"-DLA_GGML_CUDA={'ON' if args.cuda else 'OFF'}",
               f"-DGGML_AVX={'ON' if args.cpu_arch == 'avx2' else 'OFF'}", f"-DGGML_AVX2={'ON' if args.cpu_arch == 'avx2' else 'OFF'}",
               "-DGGML_NATIVE=OFF", "-DGGML_AVX512=OFF", "-DGGML_AVX512_VNNI=OFF", "-DGGML_AVX512_BF16=OFF"]
    subprocess.run(command, env=environment, check=True)
    subprocess.run(["cmake", "--build", str(build), "--config", "Release", "--parallel", "4"], env=environment, check=True)
    print(json.dumps({"build": str(build.resolve()), "cuda_requested": args.cuda}))


if __name__ == "__main__":
    main()
