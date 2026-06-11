from collections import Counter, defaultdict, deque, namedtuple
c = Counter("abracadabra")
print(c.most_common(2))
print(c['a'], c['z'])
print(sorted(c.elements()))

dd = defaultdict(list)
for k, v in [('a', 1), ('b', 2), ('a', 3)]:
    dd[k].append(v)
print(dict(dd))

dq = deque([1, 2, 3])
dq.appendleft(0)
dq.append(4)
print(list(dq))
print(dq.popleft(), dq.pop())

Point = namedtuple('Point', ['x', 'y'])
p = Point(3, 4)
print(p.x, p.y, p)
print(p[0], p[1])
