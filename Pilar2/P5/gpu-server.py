from fastapi import FastAPI
from pydantic import BaseModel
import subprocess

app = FastAPI()

class MineRequest(BaseModel):
    difficulty: str
    data: str
    start: int
    end: int


def get_gpu_name():
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
        capture_output=True,
        text=True
    )
    return result.stdout.strip().lower()


def select_binary(gpu):
    gpu = gpu.lower()

    if "4060" in gpu or "rtx 40" in gpu:
        return "./minero_sm89"
    if "3060" in gpu or "3050" in gpu or "rtx 30" in gpu:
        return "./minero_sm86"
    if "1060" in gpu or "1050" in gpu or "gtx 10" in gpu:
        return "./minero_sm61"

    return "./minero_sm61"


@app.post("/mine")
def mine(req: MineRequest):

    gpu = get_gpu_name()
    binary = select_binary(gpu)

    result = subprocess.run(
        [
            binary,
            req.data,
            req.difficulty,
            str(req.start),
            str(req.end)
        ],
        capture_output=True,
        text=True
    )

    return {"stdout": result.stdout}