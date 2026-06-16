import copy

# shallow copy shares nested objects
a = [1, [2, 3], {"k": "v"}]
b = copy.copy(a)
b.append(99)
b[1].append(4)
print(a, b)

# deepcopy fully independent
c = [1, [2, 3]]
d = copy.deepcopy(c)
d[1].append(9)
print(c, d)

# dict / set deepcopy
e = {"x": [1, 2], "y": {3, 4}}
f = copy.deepcopy(e)
f["x"].append(5)
print(e["x"], sorted(f["x"]))

# objects
class Node:
    def __init__(self, val, children):
        self.val = val
        self.children = children


n = Node(1, [Node(2, [])])
m = copy.deepcopy(n)
m.children.append(Node(3, []))
print(n.val, len(n.children), len(m.children))

# __deepcopy__ hook
class Singleton:
    def __deepcopy__(self, memo):
        return self


s = Singleton()
print(copy.deepcopy(s) is s)
