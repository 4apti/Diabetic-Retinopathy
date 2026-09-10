from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    role = Column(String, nullable=False)  # patient | health_worker | doctor | admin
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    patients = relationship("Patient", back_populates="owner", foreign_keys="Patient.created_by")


class Patient(Base):
    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False)
    age = Column(Integer, nullable=True)
    gender = Column(String, nullable=True)
    village = Column(String, nullable=True)
    district = Column(String, nullable=True)
    phone = Column(String, nullable=True, unique=True)
    own_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="patients", foreign_keys=[created_by])
    uploads = relationship(
        "ImageUpload", back_populates="patient", cascade="all, delete-orphan"
    )


class ImageUpload(Base):
    __tablename__ = "image_uploads"

    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(String, unique=True, index=True, nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    quality_status = Column(String, default="pending")  # pending | acceptable | poor
    quality_score = Column(Float, nullable=True)
    retake_count = Column(Integer, default=0)  # consecutive failed capture attempts
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    patient = relationship("Patient", back_populates="uploads")
    uploaded_by_user = relationship("User")
    findings = relationship(
        "AIFinding", back_populates="image", cascade="all, delete-orphan"
    )


class AIFinding(Base):
    __tablename__ = "ai_findings"

    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(
        String, ForeignKey("image_uploads.image_id"), index=True, nullable=False
    )
    lesion_list = Column(Text, default="[]")  # JSON array of {type, count}
    lesion_count = Column(Integer, default=0)
    icdr_grade = Column(Integer, nullable=True)
    icdr_confidence = Column(Float, nullable=True)
    consistency_status = Column(String, default="pending")  # Consistent | Flagged for Review
    analysis_status = Column(String, default="queued")  # queued | running | completed | failed
    model_provenance = Column(Text, default="{}")  # JSON describing engines used
    model_version = Column(String, nullable=True)  # engine signature used for this analysis
    error = Column(Text, nullable=True)
    analyzed_at = Column(DateTime, nullable=True)

    image = relationship("ImageUpload", back_populates="findings")
    report = relationship("ScreeningReport", back_populates="finding", uselist=False)


class ScreeningReport(Base):
    """Phase 3 — explainable AI screening report, generated once and cached.

    Persisted so the Grad-CAM heatmap and the plain-language report are not
    regenerated on every page view. Invalidated by a model_version mismatch: if
    the image is re-analyzed with a different engine signature the report is
    rebuilt in place.
    """

    __tablename__ = "screening_reports"

    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(
        String, ForeignKey("ai_findings.image_id"), unique=True, index=True, nullable=False
    )
    report_text = Column(Text, nullable=False)
    structured_findings = Column(Text, default="{}")  # JSON — clinician-facing object
    region_notes = Column(Text, nullable=True)  # image-relative quadrant activation
    gradcam_path = Column(String, nullable=True)  # null when heatmap computation failed
    generation_method = Column(String, default="template")  # template | llm
    model_version = Column(String, nullable=True)
    generated_at = Column(DateTime, default=datetime.utcnow)

    finding = relationship("AIFinding", back_populates="report")