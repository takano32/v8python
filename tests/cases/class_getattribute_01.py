# __getattribute__ intercepts every attribute access; __getattr__ is the
# fallback only for names that normal lookup (or __getattribute__) misses.


class Proxy:
    def __init__(self):
        self.real = 1

    def __getattribute__(self, name):
        if name == "secret":
            return "hidden"
        return object.__getattribute__(self, name)


p = Proxy()
print(p.secret)
print(p.real)


class Fallback:
    def __getattr__(self, name):
        return f"default:{name}"


f = Fallback()
f.here = 5
print(f.here)
print(f.missing)


# When __getattribute__ raises AttributeError, __getattr__ still runs.
class Both:
    def __getattribute__(self, name):
        if name == "boom":
            raise AttributeError(name)
        return object.__getattribute__(self, name)

    def __getattr__(self, name):
        return f"caught:{name}"


b = Both()
print(b.boom)
