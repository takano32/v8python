class Vec:
    def __init__(self, *data):
        self.data = list(data)

    def __add__(self, other):
        return Vec(*[a + b for a, b in zip(self.data, other.data)])

    def __radd__(self, other):
        # supports 0 + Vec (e.g. sum())
        return Vec(*[other + a for a in self.data])

    def __eq__(self, other):
        return self.data == other.data

    def __lt__(self, other):
        return sum(self.data) < sum(other.data)

    def __len__(self):
        return len(self.data)

    def __getitem__(self, i):
        return self.data[i]

    def __setitem__(self, i, v):
        self.data[i] = v

    def __contains__(self, x):
        return x in self.data

    def __call__(self, scale):
        return Vec(*[a * scale for a in self.data])

    def __bool__(self):
        return any(self.data)

    def __repr__(self):
        return f"Vec{tuple(self.data)}"


u = Vec(1, 2, 3)
v = Vec(4, 5, 6)
print(u + v)
print(10 + u)            # __radd__
print(u == Vec(1, 2, 3), u == v)
print(u < v, v < u)
print(len(u), u[0], u[-1])
u[1] = 99
print(u)
print(2 in v, 99 in u)
print(u(2))              # __call__
print(bool(Vec(0, 0)), bool(Vec(0, 1)))
print(sorted([v, u, Vec(0)]))
