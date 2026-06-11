# Custom __hash__ and __eq__ make instances usable as dict keys / set members.
class Color:
    def __init__(self, r, g, b):
        self.r = r
        self.g = g
        self.b = b

    def __eq__(self, other):
        return (self.r, self.g, self.b) == (other.r, other.g, other.b)

    def __hash__(self):
        return hash((self.r, self.g, self.b))

    def __repr__(self):
        return f"Color({self.r},{self.g},{self.b})"


red = Color(255, 0, 0)
red2 = Color(255, 0, 0)
blue = Color(0, 0, 255)

print(red == red2, red == blue)
print(hash(red) == hash(red2))

palette = {red: "warm", blue: "cool"}
# red2 is equal+same-hash as red, so it indexes the same entry
print(palette[red2])
palette[red2] = "hot"
print(len(palette), palette[red])

colors = {red, red2, blue}
print(len(colors))

# membership uses __eq__/__hash__
print(Color(255, 0, 0) in palette)
print(Color(1, 2, 3) in colors)

names = sorted(repr(c) for c in colors)
print(names)
