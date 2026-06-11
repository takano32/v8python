# finally with return swallows exceptions / try-return vs finally order
def swallow():
    try:
        raise ValueError("gone")
    finally:
        return "from finally"

print(swallow())


def try_return_order():
    try:
        print("in try")
        return "try value"
    finally:
        print("in finally")

print(try_return_order())


# finally return overrides try return
def override():
    try:
        return "try"
    finally:
        return "finally"

print(override())


# finally runs even when exception is not caught here, before propagation
def propagate_with_finally():
    try:
        raise KeyError("k")
    finally:
        print("cleanup ran")

try:
    propagate_with_finally()
except KeyError as e:
    print("still raised", type(e).__name__)
