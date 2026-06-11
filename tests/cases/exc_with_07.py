# with statement: custom __enter__/__exit__, suppress vs propagate
class Tracer:
    def __init__(self, name, suppress):
        self.name = name
        self.suppress = suppress

    def __enter__(self):
        print("enter", self.name)
        return self.name

    def __exit__(self, exc_type, exc_val, tb):
        print("exit", self.name, exc_type.__name__ if exc_type else None)
        return self.suppress


# normal, no exception
with Tracer("plain", False) as v:
    print("body", v)

print("--")

# __exit__ returns True -> exception suppressed
with Tracer("suppress", True):
    raise ValueError("hidden")
print("after suppress reached")

print("--")

# __exit__ returns False -> exception propagates out of with
try:
    with Tracer("propagate", False):
        raise KeyError("k")
except KeyError as e:
    print("caught", type(e).__name__)

print("--")

# nested with: exits run in reverse order
with Tracer("outer", False):
    with Tracer("inner", False):
        print("nested body")
