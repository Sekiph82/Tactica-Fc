#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ClubStatus {
    Amateur,
    SemiProfessional,
    Professional,
}
