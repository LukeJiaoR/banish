extends Node2D
## Geometry-native diorama details. These are scenery, not simulated production.
const Iso = preload("res://scripts/iso.gd")
var kind := "fence"
var start := Vector2.ZERO
var finish := Vector2.ZERO

func _draw() -> void:
	if kind == "bridge":
		_draw_bridge()
	elif kind == "garden":
		_draw_garden()
	else:
		_draw_fence()

func _draw_fence() -> void:
	var a := Iso.project(start) - position
	var b := Iso.project(finish) - position
	var length := maxi(2, int(start.distance_to(finish) * 2.0))
	for i in range(length + 1):
		var p := a.lerp(b, float(i) / length)
		draw_line(p + Vector2(3, 2), p + Vector2(10, 5), Color(0.14, 0.21, 0.1, 0.2), 3.0)
		draw_line(p, p - Vector2(0, 13), Color("655333"), 3.0)
		draw_line(p - Vector2(1, 0), p - Vector2(1, 13), Color("b4a777"), 1.0)
	for height in [5, 10]:
		draw_line(a - Vector2(0, height), b - Vector2(0, height), Color("8f8054"), 2.0)

func _draw_garden() -> void:
	var points := Iso.footprint(Vector2i(start), 3)
	for i in range(points.size()):
		points[i] -= position
	draw_colored_polygon(points, Color("8b7850"))
	for x in range(6):
		var a := Iso.project(start + Vector2(x * 0.5, 0)) - position
		var b := Iso.project(start + Vector2(x * 0.5, 3)) - position
		draw_line(a, b, Color("b3a174"), 3.0)
	for y in range(6):
		for x in range(6):
			var p := Iso.project(start + Vector2(x * 0.5 + 0.2, y * 0.5 + 0.2)) - position
			draw_circle(p + Vector2(1, 1), 3.5, Color(0.18, 0.23, 0.08, 0.3))
			_draw_oval(p, Vector2(4.2, 2.8), Color("718849"))
			draw_line(p, p - Vector2(1, 4), Color("a4b464"), 2.0)

func _draw_oval(center: Vector2, radii: Vector2, color: Color) -> void:
	var points := PackedVector2Array()
	for i in range(16):
		var angle := TAU * i / 16.0
		points.append(center + Vector2(cos(angle), sin(angle)) * radii)
	draw_colored_polygon(points, color)

func _draw_bridge() -> void:
	# Short stone crossing with a raised arched deck and individually visible
	# blocks; separate from any original transport/worker simulation.
	var width := 1.35
	for i in range(14):
		var t := i / 14.0
		var next := (i + 1) / 14.0
		var lift := sin(t * PI) * 18.0 + 4.0
		var lift_next := sin(minf(next, 1.0) * PI) * 18.0 + 4.0
		var p := start.lerp(finish, t)
		var q := start.lerp(finish, minf(next, 1.0))
		var a := Iso.project(p) - position - Vector2(0, lift)
		var b := Iso.project(q) - position - Vector2(0, lift_next)
		var c := Iso.project(q + Vector2(0, width)) - position - Vector2(0, lift_next)
		var d := Iso.project(p + Vector2(0, width)) - position - Vector2(0, lift)
		var shade := Color("c6c3a3") if i % 2 == 0 else Color("b5b49b")
		draw_colored_polygon(PackedVector2Array([a, b, c, d]), shade)
		draw_line(a, d, Color("969880"), 1.2)
		draw_colored_polygon(PackedVector2Array([d, c, c + Vector2(0, 9), d + Vector2(0, 9)]), Color("7d8877"))
		draw_line(d + Vector2(0, 9), c + Vector2(0, 9), Color("5b6f63"), 1.2)
		if i % 2 == 0:
			for edge in [a, d]:
				draw_line(edge, edge - Vector2(0, 7), Color("b5baa2"), 6.0)
				draw_line(edge - Vector2(2, 7), edge + Vector2(2, -7), Color("dedcc0"), 2.0)
