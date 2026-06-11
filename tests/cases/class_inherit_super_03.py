class Animal:
    def __init__(self, name):
        self.name = name
        self.legs = 4

    def describe(self):
        return f"{self.name} has {self.legs} legs"

    def speak(self):
        return "..."


class Dog(Animal):
    def __init__(self, name, breed):
        super().__init__(name)
        self.breed = breed

    def speak(self):
        return "Woof"

    def describe(self):
        base = super().describe()
        return f"{base} ({self.breed})"


class Bird(Animal):
    def __init__(self, name):
        super().__init__(name)
        self.legs = 2

    def speak(self):
        return "Tweet"


d = Dog("Rex", "Lab")
b = Bird("Tweety")
print(d.describe())
print(d.speak())
print(b.describe())
print(b.speak())
print(isinstance(d, Animal), isinstance(b, Dog))
