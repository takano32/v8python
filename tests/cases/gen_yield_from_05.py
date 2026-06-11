# yield from: list, another generator, return-value receipt
def chain():
    yield from [1, 2, 3]
    yield from (4, 5)
    yield from range(6, 9)

print(list(chain()))

def sub():
    yield "a"
    yield "b"
    return "RET"

def parent():
    r = yield from sub()
    print("received", r)
    yield "c"

print(list(parent()))

# yield from a string (iterates chars)
def chars():
    yield from "hi"

print(list(chars()))

# delegating with interleaved own yields
def mix():
    yield 0
    yield from sub()
    yield 9

print(list(mix()))
