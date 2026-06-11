# nested yield from chains with return value propagation
def leaf():
    yield 1
    yield 2
    return "leaf-ret"

def middle():
    r = yield from leaf()
    print("middle got", r)
    yield 3
    return "middle-ret"

def top():
    r = yield from middle()
    print("top got", r)
    yield 4

print(list(top()))

# flatten nested lists recursively with yield from
def flatten(items):
    for it in items:
        if isinstance(it, list):
            yield from flatten(it)
        else:
            yield it

print(list(flatten([1, [2, [3, 4], 5], [[6]], 7])))

# chain of three delegations producing a sequence
def a():
    yield from range(3)

def b():
    yield from a()
    yield from a()

print(list(b()))
