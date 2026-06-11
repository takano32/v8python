import random
random.seed(42)
for _ in range(100):
    v = random.randint(1, 6)
    assert 1 <= v <= 6
r = random.random()
assert 0 <= r < 1
pop = list(range(10))
c = random.choice(pop)
assert c in pop
lst = list(range(20))
random.shuffle(lst)
assert sorted(lst) == list(range(20))
s = random.sample(range(100), 5)
assert len(s) == 5 and len(set(s)) == 5
print("ok")
