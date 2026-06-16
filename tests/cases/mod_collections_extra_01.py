from collections import Counter, namedtuple, ChainMap, UserDict, UserList

# Counter multiset arithmetic
print((Counter("aab") + Counter("bc")).most_common())
print(sorted((Counter(a=3, b=1) - Counter(a=1, b=2)).items()))
print(sorted((Counter(a=3, b=1) & Counter(a=1, b=5)).items()))
print(sorted((Counter(a=3, b=1) | Counter(a=1, b=5)).items()))

# namedtuple defaults
P = namedtuple("P", "x y z", defaults=[0, 1])
print(P(9)._asdict())
print(P._field_defaults)

# ChainMap lookups and child
cm = ChainMap({"a": 1}, {"a": 2, "b": 3})
print(cm["a"], cm["b"], sorted(cm.keys()))
child = cm.new_child({"a": 99})
print(child["a"], len(child.maps))

# UserDict subclass
class LowerDict(UserDict):
    def __setitem__(self, key, value):
        super().__setitem__(key.lower(), value)


d = LowerDict()
d["ABC"] = 1
print(d["abc"], len(d))

# UserList subclass
u = UserList([3, 1, 2])
u.append(0)
print(list(u), len(u))
