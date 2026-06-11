# Custom iterator protocol plus property getter/setter.
class CountDown:
    def __init__(self, start):
        self.start = start

    def __iter__(self):
        self.current = self.start
        return self

    def __next__(self):
        if self.current <= 0:
            raise StopIteration
        self.current -= 1
        return self.current + 1


cd = CountDown(3)
print(list(cd))
print([x * x for x in CountDown(4)])
total = 0
for n in CountDown(5):
    total += n
print(total)


class Celsius:
    def __init__(self, t=0):
        self._t = t

    @property
    def temp(self):
        return self._t

    @temp.setter
    def temp(self, value):
        if value < -273:
            raise ValueError("below absolute zero")
        self._t = value

    @property
    def fahrenheit(self):
        return self._t * 9 / 5 + 32


c = Celsius(25)
print(c.temp, c.fahrenheit)
c.temp = 100
print(c.temp, c.fahrenheit)
try:
    c.temp = -500
except ValueError as e:
    print(type(e).__name__)
print(c.temp)
