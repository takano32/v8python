import itertools as it

# compress: pick data where the selector is truthy
print(list(it.compress("ABCDEF", [1, 0, 1, 0, 1, 1])))
print(list(it.compress(range(5), [True, False, True])))
print(list(it.compress("AB", [])))

# tee: independent iterators over the same source
a, b = it.tee([1, 2, 3])
print(list(a), list(b))

# tee readers advance independently and share buffered values
x, y = it.tee(iter(range(5)))
print(next(x), next(x))
print(list(y))
print(list(x))

# tee with n != 2
c = it.tee([10, 20], 3)
print([list(t) for t in c])
