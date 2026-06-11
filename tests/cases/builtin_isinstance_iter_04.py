print(isinstance(1, int), isinstance(1.0, float), isinstance("a", str))
print(isinstance(True, int), isinstance(1, (str, int)))
print(isinstance([], list), isinstance({}, dict))
print(issubclass(bool, int), issubclass(int, object))
print(issubclass(str, (int, str)), issubclass(int, float))

it = iter([1, 2, 3])
print(next(it), next(it), next(it))
print(next(it, "done"))

data = [10, 20, 30]
di = iter(data)
collected = []
for v in iter(lambda: next(di, None), None):
    collected.append(v)
print(collected)
