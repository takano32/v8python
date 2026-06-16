import pprint

# dict keys are sorted by default
pprint.pprint({"banana": 3, "apple": 1, "cherry": 2})
print(pprint.pformat({"z": 1, "a": 2, "m": 3}))

# small structures fit on one line
print(pprint.pformat([1, 2, 3]))
print(pprint.pformat((1,)))

# long lists wrap one item per line
pprint.pprint(list(range(15)))

# nested structures
pprint.pprint({"name": "alice", "scores": [10, 20, 30], "info": {"age": 30, "city": "NYC"}})

# wide dict wraps
pprint.pprint({"key" + str(i): i * i for i in range(8)})

# sort_dicts=False keeps insertion order
print(pprint.pformat({"z": 1, "a": 2}, sort_dicts=False))
