# isinstance/issubclass with tuples and the bool->int relationship,
# plus hasattr/getattr/setattr and dynamic attribute handling.
class Base: pass
class Mid(Base): pass
class Leaf(Mid): pass

x = Leaf()
print(isinstance(x, (Base, str)))
print(isinstance(x, (str, float)))
print(issubclass(Leaf, (Base, dict)))
print(issubclass(bool, int), isinstance(True, int))
print(type(3).__name__, type(True).__name__, type("a").__name__)
print(type(x).__name__)

class Config:
    debug = False
    def __init__(self):
        self.level = 1

c = Config()
print(hasattr(c, "level"), hasattr(c, "missing"), hasattr(c, "debug"))
print(getattr(c, "level"), getattr(c, "missing", "fallback"))
setattr(c, "level", 5)
setattr(c, "new_attr", "hi")
print(c.level, c.new_attr)
try:
    getattr(c, "nope")
except AttributeError as e:
    print(type(e).__name__)

# dynamically add an attribute to the class itself
Config.version = "1.0"
print(c.version, Config.version)
c2 = Config()
print(c2.version)
