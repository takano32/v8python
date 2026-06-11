# else/finally execution order, nested try, propagation across functions
def run(raise_it):
    try:
        print("try")
        if raise_it:
            raise ValueError("v")
    except ValueError:
        print("except")
    else:
        print("else")
    finally:
        print("finally")

run(False)
print("--")
run(True)
print("--")

# nested try: inner finally runs before outer except
try:
    try:
        print("inner try")
        raise KeyError("k")
    finally:
        print("inner finally")
except KeyError as e:
    print("outer except", type(e).__name__)

print("--")

# propagation across function calls
def a():
    raise RuntimeError("deep")

def b():
    a()

def c():
    b()

try:
    c()
except RuntimeError as e:
    print("propagated", str(e))
