import heapq

h = [5, 3, 8, 1, 9, 2, 7]
heapq.heapify(h)
print([heapq.heappop(h) for _ in range(len(h))])

h2 = []
for x in [4, 1, 7, 3, 8, 2]:
    heapq.heappush(h2, x)
print(heapq.heappop(h2), heapq.heappop(h2))

print(heapq.heappushpop([1, 2, 3], 0))
heapq.heapify(h3 := [2, 4, 6])
print(heapq.heapreplace(h3, 5), sorted(h3))

print(heapq.nlargest(3, [1, 8, 2, 23, 7, -4, 18]))
print(heapq.nsmallest(3, [1, 8, 2, 23, 7, -4, 18]))
print(heapq.nlargest(2, ["aa", "b", "ccc", "dd"], key=len))

print(list(heapq.merge([1, 3, 5], [2, 4, 6], [0, 7])))
