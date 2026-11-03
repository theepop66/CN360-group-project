import io

from PIL import Image

from cn360_model.experiment_images import prepare_view, source_box


def test_crop_uses_original_pixels_and_records_inverse_geometry() -> None:
    image = Image.new("RGB", (1000, 800), "white")
    data, geometry = prepare_view(image, [0.1, 0.1, 0.9, 0.9], 448)
    with Image.open(io.BytesIO(data)) as prepared:
        assert prepared.size == (448, 358)
    assert geometry["cropPixels"] == [100, 80, 900, 720]
    assert source_box([0, 0, 448, 358], geometry) == [100, 80, 900, 720]


def test_full_frame_preserves_aspect_ratio() -> None:
    _, geometry = prepare_view(Image.new("RGB", (900, 600)), [0, 0, 1, 1], 448)
    assert geometry["width"] == 448
    assert geometry["height"] == 299


def test_invalid_crop_cannot_silently_produce_an_image() -> None:
    import pytest

    for crop in [[0, 0, 0, 1], [-0.1, 0, 1, 1], [0, 0, 1.1, 1]]:
        with pytest.raises(ValueError):
            prepare_view(Image.new("RGB", (100, 100)), crop, 448)
