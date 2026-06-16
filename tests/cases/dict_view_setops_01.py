# dict_keys / dict_items support set operations

d = {"a": 1, "b": 2, "c": 3}

# keys() view is set-like
print(sorted(d.keys() & {"a", "c", "z"}))
print(sorted(d.keys() | {"z"}))
print(sorted(d.keys() - {"a"}))
print(sorted(d.keys() ^ {"a", "z"}))

# reflected: set on the left
print(sorted({"a", "z"} & d.keys()))
print(sorted({"a", "z"} - d.keys()))
print(sorted({"z"} | d.keys()))

# items() view is also set-like (elements are (key, value) tuples)
print(sorted(d.items() & {("a", 1), ("b", 99)}))
print(sorted(d.items() - {("a", 1)}))

# intersection between two dicts' key views
e = {"b": 20, "c": 30, "d": 40}
print(sorted(d.keys() & e.keys()))
