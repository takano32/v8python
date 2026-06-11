# The classic mutable-class-variable sharing trap.
class Team:
    members = []        # shared across all instances
    count = 0           # immutable rebinding is per-instance

    def add(self, name):
        self.members.append(name)   # mutates the shared list

    def bump(self):
        self.count += 1             # creates an instance attribute


t1 = Team()
t2 = Team()
t1.add("x")
t2.add("y")
# Both see the same shared list
print(t1.members)
print(t2.members)
print(Team.members)

t1.bump()
t1.bump()
t2.bump()
# count rebinding shadows the class attribute on the instance only
print(t1.count, t2.count, Team.count)

# Fixing the trap: per-instance list assigned in __init__
class Fixed:
    def __init__(self):
        self.members = []
    def add(self, name):
        self.members.append(name)

f1 = Fixed()
f2 = Fixed()
f1.add("a")
print(f1.members, f2.members)
