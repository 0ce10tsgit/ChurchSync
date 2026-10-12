import sys
if sys.platform == "win32":
    import pyaudiowpatch as pyaudio
else:
    import pyaudio
# automatically pick the right package type based on systsem
# so win gets patch and every else gets normal