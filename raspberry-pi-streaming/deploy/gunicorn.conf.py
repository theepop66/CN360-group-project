import os


bind = f"{os.getenv('HOST', '0.0.0.0')}:{os.getenv('PORT', '8000')}"
workers = 1
threads = 8
timeout = 0
accesslog = "-"
errorlog = "-"
