@echo off
echo Encendiendo el cerebro (Ollama en WSL). Deja esta ventana abierta mientras uses Jarvis...
wsl -- bash -lc "if pgrep -x ollama >/dev/null; then echo Ollama ya esta corriendo.; else OLLAMA_KEEP_ALIVE=30m ollama serve & sleep 3; fi; if ! ollama list | grep -q jarvis-cerebro; then echo Creando jarvis-cerebro con memoria ampliada de 16K...; printf \"FROM qwen3.5:4b\nPARAMETER num_ctx 16384\n\" > /tmp/Modelfile-jarvis && ollama create jarvis-cerebro -f /tmp/Modelfile-jarvis; fi; echo Listo: jarvis-cerebro disponible.; sleep infinity"
pause
