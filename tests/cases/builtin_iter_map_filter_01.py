print(list(map(lambda x: x * 2, [1, 2, 3])))
print(list(map(lambda a, b: a + b, [1, 2, 3], [10, 20, 30])))
print(list(filter(lambda x: x % 2 == 0, range(10))))
print(list(filter(None, [0, 1, 2, 0, 3, "", "a", None])))
print(list(zip([1, 2, 3], ["a", "b"])))
print(list(zip([1, 2], ["a", "b", "c"])))
try:
    list(zip([1, 2, 3], [1, 2], strict=True))
except ValueError as e:
    print("ValueError")
print(list(enumerate(["a", "b", "c"])))
print(list(enumerate(["a", "b", "c"], start=1)))
print(list(enumerate("xy", start=10)))
