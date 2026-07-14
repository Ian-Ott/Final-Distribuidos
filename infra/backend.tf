terraform {
  backend "gcs" {
    bucket = "tp-final-sdypp26-tfstate"
    prefix = "terraform/state"
  }
}
