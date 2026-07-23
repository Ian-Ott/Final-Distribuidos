from locust import HttpUser, task, between
import random

class BlockchainUser(HttpUser):
    wait_time = between(0.1, 0.5)

    @task(8)
    def create_transaction(self):
        self.client.post(
            "/transaction",
            json={
                "sender": f"user{random.randint(1,1000)}",
                "receiver": f"user{random.randint(1,1000)}",
                "amount": random.uniform(1,100)
            }
        )

    @task(1)
    def status(self):
        self.client.get("/status")

    @task(1)
    def blockchain(self):
        self.client.get("/blockchain")