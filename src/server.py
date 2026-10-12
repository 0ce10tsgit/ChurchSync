## This is server code to send video and audio frames over UDP

import socket
import asyncio
import threading, wave, time, sys
from audio_router import pyaudio

host_name = socket.gethostname()
host_ip = '0.0.0.0'#  socket.gethostbyname(host_name)
print(host_ip)
port = 9633
## For details visit: www.pyshine.com

FORMAT = pyaudio.paInt16  # 16-bit resolution
CHANNELS = 1              # 2: Stereo, 1: Mono
RATE = 44100              # 44.1kHz sampling rate
CHUNK = 300              # Record in chunks of 1024 samples
RECORD_SECONDS = 5        # Duration of recording
WAVE_OUTPUT_FILENAME = "output_pyaudio.wav"
WAVE_INPUT = sys.argv[1] if len(sys.argv) > 1 else None  # python server.py song.wav -> stream file instead of loopback

def audio_stream_UDP():

    BUFF_SIZE = 65536
    server_socket = socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
    server_socket.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,BUFF_SIZE)

    server_socket.bind((host_ip, (port)))
    p = pyaudio.PyAudio()
    if WAVE_INPUT:
        wf = wave.open(WAVE_INPUT, 'rb')
        CHANNELS, RATE = wf.getnchannels(), wf.getframerate()
        print('streaming file', WAVE_INPUT, CHANNELS, 'ch', RATE, 'Hz')
    else:
        if hasattr(p, "get_default_wasapi_loopback"):
            device = p.get_default_wasapi_loopback()  # Windows: whatever the default speakers are playing
        else:
            device = p.get_default_input_device_info()  # elsewhere: set a monitor source as default input
        # loopback has to use the speaker's own format
        CHANNELS = device["maxInputChannels"]
        RATE = int(device["defaultSampleRate"])
        print('capturing', device["name"], CHANNELS, 'ch', RATE, 'Hz')
        stream = p.open(format=FORMAT,
                        channels=CHANNELS,
                        rate=RATE,
                        input_device_index=device["index"],
                        input=True,
                        frames_per_buffer=CHUNK)
    print('server listening at',(host_ip, (port)),RATE)
    print(socket.gethostbyname(host_name))
    data = None
    sample_rate = RATE
    while True:
        msg,client_addr = server_socket.recvfrom(BUFF_SIZE)
        print('GOT connection from ',client_addr,msg)

        next_send = time.monotonic()
        sent, last_print = 0, time.monotonic()
        while True:
            if WAVE_INPUT:
                data = wf.readframes(CHUNK)
                if not data:  # loop the file
                    wf.rewind()
                    data = wf.readframes(CHUNK)
                # a file reads instantly, so pace it to real time
                # (by frames actually read: the last chunk of the file is short)
                frame_bytes = CHANNELS * wf.getsampwidth()
                next_send += len(data) / frame_bytes / RATE
                time.sleep(max(0, next_send - time.monotonic()))
            else:
                data = stream.read(CHUNK)
                frame_bytes = CHANNELS * p.get_sample_size(FORMAT)

            print("size of packet ",len(data))
            SAFE = (1400 // frame_bytes) * frame_bytes  # keep slices frame-aligned so samples never split across packets
            for i in range(0, len(data), SAFE):
                server_socket.sendto(data[i:i+SAFE], client_addr)
            sent += 1
            if time.monotonic() - last_print >= 1:
                print(f'sent {sent / (time.monotonic() - last_print):.2f} packets/s (real time = {RATE / CHUNK:.2f})')
                sent, last_print = 0, time.monotonic()
            # time.sleep(0.8*CHUNK/sample_rate)
            
            
           
                

t1 = threading.Thread(target=audio_stream_UDP, args=(), daemon=True)
t1.start()

try:
    while t1.is_alive():
        t1.join(0.5)  # timeout to allow SIGINT to slime the process
except KeyboardInterrupt:
    print("\nServer stopped.")
