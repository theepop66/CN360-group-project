import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run("cn360_model.app:create_app", factory=True, host=os.environ.get("CN360_MODEL_BIND", "0.0.0.0"), port=int(os.environ.get("CN360_MODEL_PORT", "8000")), workers=1)
