import itertools
data = [('a', 1), ('a', 2), ('b', 3), ('b', 4), ('a', 5)]
for k, g in itertools.groupby(data, key=lambda x: x[0]):
    print(k, [x[1] for x in g])
print(list(itertools.takewhile(lambda x: x < 3, [1, 2, 3, 4, 1])))
print(list(itertools.dropwhile(lambda x: x < 3, [1, 2, 3, 4, 1])))
print(list(itertools.starmap(pow, [(2, 3), (3, 2)])))
print(list(itertools.repeat(7, 3)))
