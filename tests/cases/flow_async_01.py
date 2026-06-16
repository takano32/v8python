import asyncio


async def double(x):
    return x * 2


async def add(a, b):
    await asyncio.sleep(0)
    return a + b


async def main():
    a = await double(5)
    b = await add(a, 100)
    results = await asyncio.gather(double(1), double(2), double(3))
    return b, results


print(asyncio.run(main()))


# coroutine objects
async def f():
    return "hi"


coro = f()
print(type(coro).__name__)
print(asyncio.run(coro))


# async iteration
class Counter:
    def __init__(self, n):
        self.n = n
        self.i = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.i >= self.n:
            raise StopAsyncIteration
        self.i += 1
        return self.i


async def collect():
    out = []
    async for v in Counter(4):
        out.append(v)
    return out


print(asyncio.run(collect()))


# async context manager
class Resource:
    async def __aenter__(self):
        return "opened"

    async def __aexit__(self, *exc):
        return False


async def use():
    async with Resource() as r:
        return r


print(asyncio.run(use()))
