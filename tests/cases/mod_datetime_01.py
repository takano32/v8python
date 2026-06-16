import datetime

d = datetime.date(2020, 5, 15)
print(d, d.year, d.month, d.day)
print(d.weekday(), d.isoweekday(), d.isoformat())
print(repr(d))

# arithmetic with timedelta
print(d + datetime.timedelta(days=40))
print((datetime.date(2020, 3, 1) - datetime.date(2020, 1, 1)).days)
print(datetime.date(2020, 1, 1) < datetime.date(2020, 1, 2))

# timedelta
td = datetime.timedelta(days=2, hours=3, minutes=30)
print(td, td.days, td.seconds)
print(td.total_seconds())
print(repr(datetime.timedelta(days=1, seconds=3600)))

# datetime
dt = datetime.datetime(2020, 5, 15, 14, 30, 45)
print(dt, dt.isoformat(), dt.hour, dt.minute, dt.second)
print(repr(dt))
print(dt.date())
print(datetime.datetime.fromisoformat("2021-06-20T09:15:00"))
print(datetime.datetime.combine(datetime.date(2020, 1, 1), datetime.time(12, 30)))

# strftime
print(d.strftime("%Y/%m/%d %A %B %j"))

# ordinal round-trip
print(datetime.date.fromordinal(d.toordinal()) == d)

# time
print(datetime.time(14, 30, 15), datetime.time(9, 5).isoformat())
