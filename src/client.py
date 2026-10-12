## Welcome to PyShine
## This is client code to receive video and audio frames over UDP

import socket
import sys
import threading, wave, pyaudio, time, queue

host_name = socket.gethostname()
host_ip = sys.argv[1] if len(sys.argv) > 1 else '127.0.0.1'
print(host_ip)
port = 9633
## For details visit: www.pyshine.com
q = queue.Queue(maxsize=2000)

def audio_stream_UDP():
	BUFF_SIZE = 65536
	client_socket = socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
	# OS-side buffer: room for ~100 packets so bursts aren't silently dropped
	client_socket.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,4*1024*1024)
	# fourth arguemnt is the buffer length which should be  1 < size of a read which was
	# an issue before when we use same cosntant for both buffer and read size
	p = pyaudio.PyAudio()
	CHUNK = 10*1024
	stream = p.open(format=p.get_format_from_width(2),
					channels=2,
					rate=48000,  # must match what the server prints
					output=True,
					frames_per_buffer=CHUNK)
					
### create socket
	message = b'Hello'
	client_socket.sendto(message,(host_ip,port))
	socket_address = (host_ip,port)
	
	def getAudioData():
		last_print = time.monotonic()
		received = 0
		while True:
			frame,_= client_socket.recvfrom(BUFF_SIZE)
			q.put(frame)
			received += 1
			if time.monotonic() - last_print >= 1:  # console printing is slow; once a second is enough
				print(f'Queue size... {q.qsize()}  received {received / (time.monotonic() - last_print):.2f} packets/s')
				received, last_print = 0, time.monotonic()
	t1 = threading.Thread(target=getAudioData, args=(), daemon=True)
	t1.start()
	time.sleep(5)
	print('Now Playing...')
	while True:
		frame = q.get()
		stream.write(frame)

	client_socket.close()
	print('Audio closed')
	os._exit(1)



t1 = threading.Thread(target=audio_stream_UDP, args=(), daemon=True)
t1.start()

try:
    while t1.is_alive():
        t1.join(0.5)  # timeout to allow SIGINT to slime the process
except KeyboardInterrupt:
    print("\nClient stopped.")