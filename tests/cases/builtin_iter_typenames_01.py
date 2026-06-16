# Lazy builtins expose their own type names, like CPython

print(type(enumerate("ab")).__name__)
print(type(zip([1], [2])).__name__)
print(type(map(str, [1])).__name__)
print(type(filter(None, [1])).__name__)

# the objects still behave as iterators
print(isinstance(enumerate("a"), object))
print(list(enumerate("ab", start=1)))
print(list(zip([1, 2], [3, 4])))
print(list(map(lambda x: x * 2, [1, 2, 3])))
print(list(filter(lambda x: x % 2, range(6))))
