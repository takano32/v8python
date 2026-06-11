# deliberately trigger builtin exceptions and print their type names
def name_of(fn):
    try:
        fn()
    except Exception as e:
        return type(e).__name__
    return "no error"

print(name_of(lambda: 1 / 0))          # ZeroDivisionError
print(name_of(lambda: {"a": 1}["b"]))  # KeyError
print(name_of(lambda: [1, 2][9]))      # IndexError
print(name_of(lambda: "s" + 5))        # TypeError
print(name_of(lambda: (42).no_attr))   # AttributeError
print(name_of(lambda: undefined_var))  # NameError


# exception hierarchy: all are subclasses of Exception
for fn in [lambda: 1 / 0, lambda: {}["x"], lambda: [][0]]:
    try:
        fn()
    except Exception as e:
        print(type(e).__name__, isinstance(e, Exception))

# LookupError is the common base of KeyError and IndexError
try:
    [][0]
except LookupError as e:
    print("LookupError base", type(e).__name__)

try:
    {}["k"]
except LookupError as e:
    print("LookupError base", type(e).__name__)
