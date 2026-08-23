from __future__ import annotations

import atexit
import logging

from pi_stream.app import create_app
from pi_stream.camera import CameraService
from pi_stream.config import Settings


settings = Settings.from_env()
logging.basicConfig(
    level=getattr(logging, settings.log_level),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
camera_service = CameraService(settings)
camera_service.start()
atexit.register(camera_service.stop)
app = create_app(settings, camera_service)


if __name__ == "__main__":
    app.run(
        host=settings.host,
        port=settings.port,
        threaded=True,
        use_reloader=False,
    )
