import math

# nextafter moves one representable step toward the target
print(math.nextafter(1.0, 2.0) > 1.0)
print(math.nextafter(1.0, 0.0) < 1.0)
print(math.nextafter(1.0, 1.0))
print(math.nextafter(0.0, 1.0) == 5e-324)
print(math.nextafter(2.0, 2.0))

# ulp: size of the gap to the next float
print(math.ulp(1.0))
print(math.ulp(0.0) == 5e-324)
print(math.ulp(2.0) == 2 * math.ulp(1.0))
print(math.nextafter(1.0, math.inf) - 1.0 == math.ulp(1.0))
