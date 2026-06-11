import itertools
print(list(itertools.chain([1, 2], [3, 4], [5])))
print(list(itertools.islice(itertools.count(10), 5)))
print(list(itertools.product([1, 2], ['a', 'b'])))
print(list(itertools.permutations([1, 2, 3], 2)))
print(list(itertools.combinations([1, 2, 3, 4], 2)))
print(list(itertools.accumulate([1, 2, 3, 4, 5])))
print(list(itertools.zip_longest([1, 2, 3], ['a', 'b'], fillvalue='?')))
print(list(itertools.chain.from_iterable([[1, 2], [3, 4]])))
