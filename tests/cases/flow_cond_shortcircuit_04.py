# ternary conditional expression
for x in range(-2, 3):
    print(x, "abs", x if x >= 0 else -x)

# short-circuit and/or return values
print(0 or 'a')
print('' or 0 or [])
print([] and 1)
print(5 and 6)
print(1 and 0 or 2)

# not
print(not 0, not 1, not [], not [1], not None)

# side-effect ordering of short circuit
log = []
def f(v, r):
    log.append(v)
    return r

f(1, False) and f(2, True)
f(3, True) or f(4, False)
print(log)
