from fastapi import FastAPI
from pydantic import BaseModel
import subprocess

app = FastAPI()

class MineRequest(BaseModel):
    difficulty: str
    data: str
    start: int
    end: int

@app.post("/mine")
def mine(req: MineRequest):
    # Ejecuta el binario de CUDA usando el hardware asignado a este Pod
    resultado = subprocess.run(
        [
            "./minero",
            req.data,         # <cadena_base>
            req.difficulty,   # <prefijo>
            str(req.start),   # <rango_inicio>
            str(req.end)      # <rango_fin>
        ],
        capture_output=True,
        text=True
    )
    return {"stdout": resultado.stdout}