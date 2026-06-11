# assert statement / AssertionError / StopIteration
# passing assert produces no output
assert 1 + 1 == 2
print("assert passed")

try:
    assert False, "custom message"
except AssertionError as e:
    print("assert msg", str(e))

try:
    assert 1 == 2
except AssertionError as e:
    print("assert no msg", e.args == ())


# StopIteration from exhausted iterator
it = iter([10, 20])
print(next(it))
print(next(it))
try:
    next(it)
except StopIteration:
    print("stopped")


# next() with default avoids the exception
it2 = iter([])
print(next(it2, "default"))


# generator raising StopIteration when exhausted
def gen():
    yield 1
    yield 2

g = gen()
vals = []
while True:
    try:
        vals.append(next(g))
    except StopIteration:
        break
print(vals)
print(isinstance(StopIteration(), Exception))
