from __future__ import annotations

import atexit
import logging

from pi_stream.app import create_app
from pi_stream.camera import CameraService
from pi_stream.config import Settings
from pi_stream.push import FramePusher


settings = Settings.from_env()
logging.basicConfig(
    level=getattr(logging, settings.log_level),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
camera_service = CameraService(settings)
camera_service.start()
atexit.register(camera_service.stop)

pusher: FramePusher | None = None
if settings.n8n_webhook_url:
    pusher = FramePusher(settings, camera_service)
    pusher.start()
    atexit.register(pusher.stop)

app = create_app(settings, camera_service, pusher=pusher)


if __name__ == "__main__":
    app.run(
        host=settings.host,
        port=settings.port,
        threaded=True,
        use_reloader=False,
    )
