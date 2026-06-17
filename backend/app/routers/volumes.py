from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import CurrentUser
from app.models import Volume
from app.routers.novels import _get_owned_novel
from app.schemas.volume import VolumeCreate, VolumeOut, VolumeUpdate

router = APIRouter(prefix="/novels/{novel_id}/volumes", tags=["volumes"])


@router.get("", response_model=list[VolumeOut])
def list_volumes(
    novel_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> list[Volume]:
    _get_owned_novel(db, user.id, novel_id)
    return (
        db.query(Volume)
        .filter(Volume.novel_id == novel_id)
        .order_by(Volume.sort_order, Volume.id)
        .all()
    )


@router.post("", response_model=VolumeOut, status_code=status.HTTP_201_CREATED)
def create_volume(
    novel_id: int,
    body: VolumeCreate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Volume:
    _get_owned_novel(db, user.id, novel_id)
    volume = Volume(
        novel_id=novel_id,
        title=body.title,
        summary=body.summary,
        sort_order=body.sort_order,
    )
    db.add(volume)
    db.commit()
    db.refresh(volume)
    return volume


@router.patch("/{volume_id}", response_model=VolumeOut)
def update_volume(
    novel_id: int,
    volume_id: int,
    body: VolumeUpdate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> Volume:
    _get_owned_novel(db, user.id, novel_id)
    volume = db.get(Volume, volume_id)
    if volume is None or volume.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="卷不存在")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(volume, key, value)
    db.add(volume)
    db.commit()
    db.refresh(volume)
    return volume


@router.delete("/{volume_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_volume(
    novel_id: int,
    volume_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
) -> None:
    _get_owned_novel(db, user.id, novel_id)
    volume = db.get(Volume, volume_id)
    if volume is None or volume.novel_id != novel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="卷不存在")
    db.delete(volume)
    db.commit()
