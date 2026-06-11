t = (1,)
print(t)
print(len(t))
print(type(t).__name__)

empty = ()
print(empty)
print(len(empty))

notuple = (5)
print(notuple)
print(type(notuple).__name__)

t = (1, 2, 2, 3, 2)
print(t.count(2))
print(t.index(3))

print((1, 2, 3) < (1, 2, 4))
print((1, 2) < (1, 2, 3))
print((1, 2, 3) == (1, 2, 3))
print([1, 2] < [1, 3])
print([1, 2, 3] < [1, 2])
print([1, 2] < [1, 2, 0])

d = {(1, 2): "a", (3, 4): "b"}
print(d[(1, 2)])
print(d[(3, 4)])

a, b = (10, 20)
print(a, b)
print(tuple([1, 2, 3]))
print(tuple("ab"))
