import json
data = {"name": "Alice", "age": 30, "scores": [95, 87, 92], "active": True, "extra": None}
s = json.dumps(data)
print(s)
back = json.loads(s)
print(back == data)
print(type(back["age"]).__name__, type(back["scores"][0]).__name__)
print(json.dumps([1, 2.5, "three", None, False]))
print(json.dumps({"b": 2, "a": 1}, sort_keys=True))
print(json.loads('{"x": 1.5, "y": 10}'))
