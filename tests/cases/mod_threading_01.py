import threading

# Thread with target (runs synchronously in this implementation)
out = []


def work(n):
    out.append(n * 2)


t = threading.Thread(target=work, args=(5,))
t.start()
t.join()
print(out)


# Thread subclass overriding run()
class Worker(threading.Thread):
    def __init__(self, n):
        super().__init__()
        self.n = n
        self.result = None

    def run(self):
        self.result = self.n + 1


w = Worker(10)
w.start()
w.join()
print(w.result)


# multiple threads
results = []
threads = [threading.Thread(target=lambda i=i: results.append(i)) for i in range(5)]
for th in threads:
    th.start()
for th in threads:
    th.join()
print(sorted(results))


# Lock as context manager
lock = threading.Lock()
with lock:
    shared = 42
print(shared)
print(lock.acquire(), end=" ")
lock.release()
print("released")


# Event
ev = threading.Event()
print(ev.is_set())
ev.set()
print(ev.is_set())
